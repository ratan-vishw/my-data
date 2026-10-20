#include<iostream>
using namespace std;
int main(){
  cout<<"Enter Number: ";
  int n;
  cin>>n;
  int sum = 0;
  for (int i = 1; n>=i; i++){
    if (i%2 != 0){
      cout<<i<<" ";
      sum += i;
    }
  }
  cout<<"Sum: "<<sum;
  cout<<endl;
  return 0;
}