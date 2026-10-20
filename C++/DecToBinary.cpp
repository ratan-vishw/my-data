#include<iostream>
using namespace std;
int dectobinary(int decnum){
  int power = 1, ans = 0;
  while (decnum > 0){
    int rem = decnum % 2;
    decnum /= 2;
    ans += (rem*power);
    power *= 10;
  }
  return ans;
}

int main (){
  cout<<"Enter Number to convert it to binary: ";
  int n;
  cin>>n;
  cout<<dectobinary(n)<<endl;
  return 0;
}