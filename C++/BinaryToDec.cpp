#include<iostream>
#include<math.h>
using namespace std;
int binarytodec(int binarynum){
  int ans = 0;
  for (int i = 0; binarynum != 0; i++){
    int lastdigit = binarynum % 2;
    if (lastdigit == 1){
      ans += pow(2,i);
    }else {
      ans += 0;
    }
    binarynum /= 10;                  
  }
  return ans;
}

int main (){
  cout<<"Enter binary number to convert into decimal: ";
  int n;
  cin>>n;
  cout<<binarytodec(n)<<endl;
  return 0;
}